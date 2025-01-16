{
  description = "Incredibly fast JavaScript runtime, bundler, test runner, and package manager – all in one";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs";
    systems.url = "github:nix-systems/default";
    flake-parts.url = "github:hercules-ci/flake-parts";
    zig = {
      url = "github:ziglang/zig?ref=pull/20511/head";
      flake = false;
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      systems,
      flake-parts,
      zig,
    }@inputs:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = import systems;
      perSystem =
        {
          config,
          pkgs,
          self',
          inputs',
          ...
        }:
        let
          inherit (pkgs) lib;
          llvmPackages = pkgs.llvmPackages_18;

          zig = (
            (pkgs.zig_0_13.overrideAttrs (
              finalAttrs: p: {
                version = "0.14.0-git+${inputs.zig.shortRev or "dirty"}";
                src = inputs.zig;

                doInstallCheck = false;

                postBuild = "";
                postInstall = "";

                outputs = [ "out" ];
              }
            )).override
              {
                llvmPackages = pkgs.llvmPackages_19;
              }
          );
        in
        {
          packages.default = llvmPackages.stdenv.mkDerivation (finalAttrs: {
            pname = "bun";
            version = "${self.shortRev or "dirty"}";

            src = inputs.self.outPath;

            passthru = {
              packages = {
                "packages/bun-error" = {
                  name = "bun-error-npm-deps-${finalAttrs.version}";
                  hash = "sha256-K1x/Ho0eTCMI6KUP2nOg6aQ3pQ/4Qw3cnsHAFZDpTjE=";
                };
                "src/node-fallbacks" = {
                  name = "node-fallbacks-npm-deps-${finalAttrs.version}";
                  hash = "sha256-JuHRAeZlVaTRJmjkzTqeNj1UGyyHF9ZsRjPLY6AUlgg=";
                };
              };
              packageLockHash = "sha256-B/c+TZpisbvBO/q8RGDm4caWJRVoL4qbuZfvIgFtmtg=";
              bunNpmDepsHash = "sha256-w5U7XbtvTHkUHnhtaUlyRaZYU3stl8GmmRCNCI/U7hw=";
            };

            lockPaths = finalAttrs.lockCollections.paths;
            lockCollections =
              pkgs.runCommand "${finalAttrs.pname}-locks-${finalAttrs.version}"
                {
                  src = inputs.self.outPath;

                  nativeBuildInputs = with pkgs; [ bun ];

                  paths = lib.attrNames finalAttrs.passthru.packages;

                  outputHash = finalAttrs.passthru.packageLockHash;
                  outputHashAlgo = "sha256";
                  outputHashMode = "recursive";

                  SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
                }
                ''
                  runPhase unpackPhase

                  for path in ''${paths[@]}; do
                    pushd $path
                    bun install --frozen-lockfile

                    mkdir -p $out/$path

                    if [[ -f bun.lockdb ]]; then
                      cp bun.lockdb $out/$path
                    fi

                    popd
                  done
                '';

            npmFlags = [ "--legacy-peer-deps" ];

            lolhtmlSource =
              pkgs.runCommand "lolhtml-source"
                {
                  src = pkgs.fetchzip {
                    url = "https://github.com/cloudflare/lol-html/archive/4f8becea13a0021c8b71abd2dcc5899384973b66.tar.gz";
                    hash = "sha256-/hZDs2WvYZSByhaahA4HeF1hJEOGy8QGYmt8N7qCoaQ=";
                  };
                }
                ''
                  runPhase unpackPhase
                  cd ..
                  cp -r $sourceRoot $out
                  cp ${./patches/lolhtml/Cargo.lock} $out/c-api/Cargo.lock
                '';

            postUnpack = ''
              for path in ''${lockPaths[@]}; do
                if [[ -f $lockCollections/$path/bun.lockdb ]]; then
                  cp $lockCollections/$path/bun.lockdb $sourceRoot/$path/bun.lockdb
                fi
              done

              mkdir -p $sourceRoot/nix-deps

              ls $sourceRoot/nix-deps
              cp -r $lolhtmlSource $sourceRoot/nix-deps/lolhtml
              chmod u+rw -R $sourceRoot/nix-deps
            '';

            npmDeps = pkgs.fetchNpmDeps {
              name = "bun-npm-deps-${finalAttrs.version}";
              inherit (finalAttrs) src;
              hash = finalAttrs.passthru.bunNpmDepsHash;
            };

            cargoDeps = pkgs.rustPlatform.fetchCargoTarball {
              src = finalAttrs.lolhtmlSource;
              hash = "sha256-7G5cu6hmDKqYBYBZq3jISmHazi2P7AUc5MsNOFPtsP4=";
              sourceRoot = "lolhtml-source/c-api";
            };

            cargoRoot = "nix-deps/lolhtml/c-api";

            preConfigure = ''
              ${lib.concatMapAttrsStringSep "\n" (
                path:
                { name, hash }:
                ''
                  pushd ${path}
                  export npmDeps=${
                    pkgs.fetchNpmDeps {
                      inherit name hash;
                      src = "${finalAttrs.src}/${path}";
                    }
                  }

                  echo $npmDeps
                  runHook npmConfigHook
                  popd
                ''
              ) finalAttrs.passthru.packages}

              export cmakeFlags=(''${cmakeFlags[@]} -DLOLHTML_PATH=$(pwd)/nix-deps/lolhtml)
            '';

            nativeBuildInputs = with pkgs; [
              cmake
              ninja
              llvmPackages.llvm
              llvmPackages.bintools
              cargo
              perl
              # Bun needs bun to build bun
              bun
              nodejs
              npmHooks.npmConfigHook
              rustPlatform.cargoSetupHook
            ];

            cmakeFlags =
              let
                mkSource =
                  name: src:
                  lib.cmakeFeature "${name}_PATH" (
                    toString (
                      pkgs.runCommand "${lib.toLower name}-source"
                        {
                          inherit src;
                        }
                        ''
                          cp -r $src $out
                        ''
                    )
                  );
              in
              [
                (lib.cmakeFeature "ZIG_PATH" (builtins.toString zig))
                (lib.cmakeFeature "ZIG_EXECUTABLE" (lib.getExe zig))
                (lib.cmakeBool "WEBKIT_LOCAL" true)
                (lib.cmakeBool "USE_SYSTEM_ICU" true)
                (lib.cmakeBool "DONT_BUN_INSTALL" true)
                (lib.cmakeFeature "CARGO_ARGS" "--offline")
                (lib.cmakeFeature "WEBKIT_PATH" (
                  toString (
                    pkgs.webkitgtk_6_0.overrideAttrs (
                      f: p: {
                        pname = "webkit-jsc";
                        name = "${f.pname}-${f.version}";

                        cmakeFlags = [
                          (lib.cmakeFeature "PORT" "JSCOnly")
                          (lib.cmakeBool "ENABLE_STATIC_JSC" true)
                        ];

                        outputs = [ "out" ];

                        installTargets = "jsc-copy-headers";

                        installPhase = ''
                          runHook preInstall

                          mkdir -p $out
                          cp cmakeconfig.h $out/cmakeconfig.h

                          mkdir -p $out/lib
                          cp lib/libWTF.a $out/lib
                          cp lib/libJavaScriptCore.a $out/lib
                          cp lib/libbmalloc.a $out/lib

                          mkdir -p $out/JavaScriptCore/PrivateHeaders/JavaScriptCore
                          cp ../Source/JavaScriptCore/heap/WeakHandleOwner.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/WeakHandleOwner.h
                          cp ../Source/JavaScriptCore/runtime/LazyClassStructureInlines.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/LazyClassStructureInlines.h
                          cp ../Source/JavaScriptCore/runtime/LazyPropertyInlines.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/LazyPropertyInlines.h
                          cp ../Source/JavaScriptCore/runtime/JSTypedArrayViewPrototype.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSTypedArrayViewPrototype.h
                          cp ../Source/JavaScriptCore/runtime/JSTypedArrayPrototypes.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSTypedArrayPrototypes.h
                          cp ../Source/JavaScriptCore/runtime/JSModuleNamespaceObject.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSModuleNamespaceObject.h
                          cp ../Source/JavaScriptCore/jit/JIT.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JIT.h
                          cp ../Source/JavaScriptCore/bytecode/StructureStubInfo.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/StructureStubInfo.h
                          cp ../Source/JavaScriptCore/bytecode/AccessCase.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/AccessCase.h
                          cp ../Source/JavaScriptCore/bytecode/ObjectPropertyConditionSet.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/ObjectPropertyConditionSet.h
                          cp ../Source/JavaScriptCore/bytecode/PolyProtoAccessChain.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/PolyProtoAccessChain.h
                          cp ../Source/JavaScriptCore/bytecode/InlineCacheCompiler.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/InlineCacheCompiler.h
                          cp ../Source/JavaScriptCore/bytecode/StructureStubClearingWatchpoint.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/StructureStubClearingWatchpoint.h
                          cp ../Source/JavaScriptCore/bytecode/AdaptiveInferredPropertyValueWatchpointBase.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/AdaptiveInferredPropertyValueWatchpointBase.h
                          cp ../Source/JavaScriptCore/bytecode/StubInfoSummary.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/StubInfoSummary.h
                          cp ../Source/JavaScriptCore/runtime/CommonSlowPaths.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/CommonSlowPaths.h
                          cp ../Source/JavaScriptCore/runtime/DirectArguments.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/DirectArguments.h
                          cp ../Source/JavaScriptCore/runtime/GenericArguments.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/GenericArguments.h
                          cp ../Source/JavaScriptCore/runtime/SamplingProfiler.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/SamplingProfiler.h
                          cp ../Source/JavaScriptCore/runtime/ScopedArguments.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/ScopedArguments.h
                          cp ../Source/JavaScriptCore/runtime/JSLexicalEnvironment.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSLexicalEnvironment.h
                          cp ../Source/JavaScriptCore/jit/JITDisassembler.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITDisassembler.h
                          cp ../Source/JavaScriptCore/jit/JITInlineCacheGenerator.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITInlineCacheGenerator.h
                          cp ../Source/JavaScriptCore/jit/JITMathIC.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITMathIC.h
                          cp ../Source/JavaScriptCore/jit/JITAddGenerator.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITAddGenerator.h
                          cp ../Source/JavaScriptCore/jit/JITMathICInlineResult.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITMathICInlineResult.h
                          cp ../Source/JavaScriptCore/jit/SnippetOperand.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/SnippetOperand.h
                          cp ../Source/JavaScriptCore/jit/JITMulGenerator.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITMulGenerator.h
                          cp ../Source/JavaScriptCore/jit/JITNegGenerator.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITNegGenerator.h
                          cp ../Source/JavaScriptCore/jit/JITSubGenerator.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITSubGenerator.h
                          cp ../Source/JavaScriptCore/bytecode/Repatch.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/Repatch.h
                          cp ../Source/JavaScriptCore/jit/JITRightShiftGenerator.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITRightShiftGenerator.h
                          cp ../Source/JavaScriptCore/jit/JITBitBinaryOpGenerator.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITBitBinaryOpGenerator.h
                          cp ../Source/JavaScriptCore/jit/JSInterfaceJIT.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSInterfaceJIT.h
                          cp ../Source/JavaScriptCore/llint/LLIntData.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/LLIntData.h
                          cp ../Source/JavaScriptCore/bytecode/FunctionCodeBlock.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/FunctionCodeBlock.h
                          cp ../Source/JavaScriptCore/dfg/DFGAbstractHeap.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/DFGAbstractHeap.h
                          cp ../Source/JavaScriptCore/bytecode/OperandsInlines.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/OperandsInlines.h
                          cp ../Source/JavaScriptCore/bytecode/Operands.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/Operands.h
                          cp ../Source/JavaScriptCore/domjit/DOMJITHeapRange.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/DOMJITHeapRange.h
                          cp ../Source/JavaScriptCore/runtime/GeneratorPrototype.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/GeneratorPrototype.h
                          cp ../Source/JavaScriptCore/runtime/GeneratorFunctionPrototype.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/GeneratorFunctionPrototype.h
                          cp ../Source/JavaScriptCore/runtime/AsyncFunctionPrototype.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/AsyncFunctionPrototype.h
                          cp ../Source/JavaScriptCore/runtime/SymbolObject.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/SymbolObject.h
                          cp ../Source/JavaScriptCore/runtime/JSGenerator.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSGenerator.h
                          cp ../Source/JavaScriptCore/bytecode/UnlinkedFunctionCodeBlock.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/UnlinkedFunctionCodeBlock.h
                          cp ../Source/JavaScriptCore/runtime/AggregateError.h $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/AggregateError.h
                          cp ../Source/JavaScriptCore/API/JSWeakValue.h  $out/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSWeakValue.h

                          runHook postInstall
                        '';

                        postFixup = "";
                      }
                    )
                  )
                ))
                (mkSource "NODEJS_HEADERS" (
                  pkgs.fetchzip {
                    url = "https://nodejs.org/dist/v22.6.0/node-v22.6.0-headers.tar.gz";
                    hash = "sha256-FszX9aLpdvO1l5yhi220gM7XknSu3jTKRgmuZDZoSS4=";
                  }
                ))
                (mkSource "PICOHTTPPARSER" (
                  pkgs.fetchzip {
                    url = "https://github.com/h2o/picohttpparser/archive/066d2b1e9ab820703db0837a7255d92d30f0c9f5.tar.gz";
                    hash = "sha256-5wQO5D4rA89mGohCuGtPBXFhTqpyHr3PmMzjTkYPTzw=";
                  }
                ))
                (mkSource "BORINGSSL" (
                  pkgs.fetchzip {
                    url = "https://github.com/oven-sh/boringssl/archive/914b005ef3ece44159dca0ffad74eb42a9f6679f.tar.gz";
                    hash = "sha256-67UYIgvCDrYWlq5SvWHTbnusHyEFnChFZBMBtzYgPLU=";
                  }
                ))
                (mkSource "MIMALLOC" (
                  pkgs.fetchzip {
                    url = "https://github.com/oven-sh/mimalloc/archive/82b2c2277a4d570187c07b376557dc5bde81d848.tar.gz";
                    hash = "sha256-kRx1SgPtaZIfFv0rJMxzH0qmQPGTxSrgv/aMiz+o0sY=";
                  }
                ))
                (mkSource "LIBARCHIVE" (
                  pkgs.fetchzip {
                    url = "https://github.com/libarchive/libarchive/archive/898dc8319355b7e985f68a9819f182aaed61b53a.tar.gz";
                    hash = "sha256-Za+FCFfB++N/A8J417YEWdYdoCU2WJG6LukAGmx8Uqo=";
                  }
                ))
                (mkSource "LIBDEFLATE" (
                  pkgs.fetchzip {
                    url = "https://github.com/ebiggers/libdeflate/archive/9d624d1d8ba82c690d6d6be1d0a961fc5a983ea4.tar.gz";
                    hash = "sha256-KpKY0A1cRV9XR1WrE15Eewf2fDWwIFGjQm/fFCnBDrg=";
                  }
                ))
                (mkSource "ZSTD" (
                  pkgs.fetchzip {
                    url = "https://github.com/facebook/zstd/archive/794ea1b0afca0f020f4e57b6732332231fb23c70.tar.gz";
                    hash = "sha256-qcd92hQqVBjMT3hyntjcgk29o9wGQsg5Hg7HE5C0UNc=";
                  }
                ))
                (mkSource "TINYCC" (
                  pkgs.runCommand "tinycc-source"
                    {
                      src = pkgs.fetchzip {
                        url = "https://github.com/oven-sh/tinycc/archive/29985a3b59898861442fa3b43f663fc1af2591d7.tar.gz";
                        hash = "sha256-yP7lAxU/ciqXXbwJBZnNiBx8AwZG6ue8tC/9KYOXiwg=";
                      };
                    }
                    ''
                      runPhase unpackPhase
                      patch -i ${./patches/tinycc/tcc.h.patch}

                      cd ..
                      cp -r $sourceRoot $out
                      cd $sourceRoot

                      cp -r ${./patches/tinycc/CMakeLists.txt} $out/CMakeLists.txt
                    ''
                ))
                (mkSource "LSHPACK" (
                  pkgs.fetchzip {
                    url = "https://github.com/litespeedtech/ls-hpack/archive/32e96f10593c7cb8553cd8c9c12721100ae9e924.tar.gz";
                    hash = "sha256-mMUj3rgle6sfv2vjJEiQugBr8Qbd0SJz5lZer79EVfc=";
                  }
                ))
                (mkSource "CARES" (
                  pkgs.fetchzip {
                    url = "https://github.com/c-ares/c-ares/archive/4f4912bce7374f787b10576851b687935f018e17.tar.gz";
                    hash = "sha256-6xJSo4ptXAKFwCUBRAji8DSqkxoIL6lpWvnDOM1NQNg=";
                  }
                ))
                (mkSource "ZLIB" (
                  pkgs.fetchzip {
                    url = "https://github.com/cloudflare/zlib/archive/886098f3f339617b4243b286f5ed364b9989e245.tar.gz";
                    hash = "sha256-GPaiiWfdKaiW3SRm+5fqVyS+10fNOWbSyVaIJLykK+M=";
                  }
                ))
                (mkSource "BROTLI" (
                  pkgs.fetchzip {
                    url = "https://github.com/google/brotli/archive/refs/tags/v1.1.0.tar.gz";
                    hash = "sha256-MvceRcle2dSkkucC2PlsCizsIf8iv95d8Xjqew266wc=";
                  }
                ))
              ];

            inherit (pkgs.bun) meta;
          });
        };
    };
}
