ndk=/opt/android-ndk
dir=$(mktemp -d)
download "$ANDROID_NDK_URL" "$dir/ndk.zip"
unzip -q "$dir/ndk.zip" -d /opt
mv "/opt/android-ndk-$ANDROID_NDK_VERSION" "$ndk"
rm -rf "$dir"
# The NDK's own clang, lldb and non-Android runtimes: about 1.1 GB nothing uses.
prebuilt="$ndk/toolchains/llvm/prebuilt/linux-x86_64"
(cd "$prebuilt" && rm -rf bin python3 lib/liblldb.so)
(cd "$ndk" && rm -rf simpleperf shader-tools sources)
set_env ANDROID_NDK_ROOT "$ndk"

# clang looks for libclang_rt.builtins and libunwind in its own resource
# directory and nowhere else, so the NDK's are linked into it: in the flat
# layout apt.llvm.org's clang uses and in the per-triple one.
resource_dir=$(clang -print-resource-dir)
ndk_clang=$(ls "$prebuilt/lib/clang/" | head -n1)
ndk_rt="$prebuilt/lib/clang/$ndk_clang/lib/linux"
for arch in aarch64 x86_64; do
  mkdir -p "$resource_dir/lib/linux/$arch" "$resource_dir/lib/$arch-unknown-linux-android$ANDROID_API_LEVEL"
  ln -sf "$ndk_rt/libclang_rt.builtins-$arch-android.a" "$resource_dir/lib/linux/"
  ln -sf "$ndk_rt/$arch/libunwind.a" "$resource_dir/lib/linux/$arch/"
  ln -sf "$ndk_rt/libclang_rt.builtins-$arch-android.a" "$resource_dir/lib/$arch-unknown-linux-android$ANDROID_API_LEVEL/libclang_rt.builtins.a"
  ln -sf "$ndk_rt/$arch/libunwind.a" "$resource_dir/lib/$arch-unknown-linux-android$ANDROID_API_LEVEL/libunwind.a"
done

[ -f "$resource_dir/lib/aarch64-unknown-linux-android$ANDROID_API_LEVEL/libunwind.a" ] || fail "the NDK's libunwind is not where clang looks for it"
