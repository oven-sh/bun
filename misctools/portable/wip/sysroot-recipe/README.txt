Portable-ABI sysroot (x86_64). Built by the "jsc" spike job; scripts and logs: /tmp/portable/jsc/scripts, /tmp/portable/jsc/logs
=========================================================================================================
Contents
  usr/include, usr/lib          musl 1.2.5 (github.com/kraj/musl tag v1.2.5), static only: libc.a crt1.o rcrt1.o Scrt1.o crti.o crtn.o
                                CFLAGS: -femulated-tls -mno-red-zone -fPIE (+ musl's own defaults, -O2)
                                Patched: 2 hand-written asm files used the red zone (fenv.s, exp2l.s), see
                                /tmp/portable/jsc/patches/musl-1.2.5-no-red-zone-asm.diff
  usr/include/{linux,asm,asm-generic}   Linux kernel headers copied from the build host
  usr/include/c++/v1, usr/lib/libc++.a libc++abi.a libunwind.a libc++experimental.a
                                LLVM runtimes from llvm-project 069ef0e7cb36 (= the host clang 23.1.2 commit), static only,
                                LIBCXX_HAS_MUSL_LIBC=ON, flags -femulated-tls -mno-red-zone -fPIE.
                                libc++.a already contains libc++abi; libc++abi.a already contains libunwind.
  clang-resource-dir/           private clang resource dir: include/ = copy of the host clang builtin headers,
                                lib/x86_64-unknown-linux-musl/{libclang_rt.builtins.a,clang_rt.crtbegin.o,clang_rt.crtend.o}
                                compiler-rt builtins built with the portable flags. Has __emutls_get_address (emutls.c).
                                Patched: x86_64/floatundixf.S used the red zone, see
                                /tmp/portable/jsc/patches/llvm-compiler-rt-floatundixf-no-red-zone.diff
  usr/lib/libclang_rt.builtins.a   copy of the same builtins, so that "-lclang_rt.builtins" works with only --sysroot
  portable.cfg                  clang config file with every flag below
  usr/include/unicode, usr/lib/libicu{uc,i18n,data}.a    ICU 78.3, static, full data, same flags (-Os)

How to use
  clang --config=/tmp/portable/sysroot/portable.cfg -O2 -static-pie x.c
  or spelled out:
  clang++ --target=x86_64-linux-musl --sysroot=/tmp/portable/sysroot \
     -resource-dir=/tmp/portable/sysroot/clang-resource-dir \
     -stdlib++-isystem /tmp/portable/sysroot/usr/include/c++/v1 \
     -femulated-tls -mno-red-zone -fPIE \
     -stdlib=libc++ -rtlib=compiler-rt -unwindlib=libunwind -fuse-ld=lld -static-pie x.cpp

Gotchas that were hit
  1. Without -stdlib++-isystem (or -nostdinc++ -isystem ...), the Debian clang puts ITS OWN libc++ headers
     (/usr/lib/llvm-23/include/c++/v1, configured for glibc) before the sysroot: compile errors in <__locale>.
  2. Without -resource-dir, -rtlib=compiler-rt links the host's libclang_rt.builtins-x86_64.a, which is
     compiled WITH a red zone. Without -rtlib=compiler-rt the driver asks for -lgcc / -lgcc_eh, which do not exist here.
  3. For a non-clang linker driver (rustc): link order that works is
       rcrt1.o crti.o clang_rt.crtbegin.o <objects> -lc++ (if C++) libclang_rt.builtins.a libunwind.a -lc clang_rt.crtend.o crtn.o
     with  -static -pie --no-dynamic-linker -z text
  4. %fs: in the result: musl reads the thread pointer with "mov %fs:0,%reg" (__pthread_self, inlined in many
     libc functions). That is the only TLS instruction form musl emits. Everything else goes through
     __emutls_get_address -> pthread_getspecific.

Measured by the jsc job (details /tmp/portable/jsc/NOTES.md, /tmp/portable/jsc/REPORT.json)
  - every archive here was scanned: no instruction addresses memory below %rsp; %fs: only in musl (81 sites, 79 of them
    "movq %fs:0,%reg"); no %gs:.
  - musl's memcpy/memmove are slow for this CPU class: 4096 byte memcpy 244 ns vs 50 ns with glibc; musl's libm about
    1.4 to 1.6 times slower than glibc's for sin/exp/log/pow. Replacement objects built from LLVM libc with the
    portable flags are in /tmp/portable/jsc/memfn/*.o (memcpy memmove memset memcmp bcmp), link them before -lc.
  - an emulated TLS runtime that allocates with malloc (compiler-rt's does) recurses forever if malloc itself is an
    allocator that keeps its state in a compiler thread local (mimalloc default). See NOTES.md, "mimalloc".
