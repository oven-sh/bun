import { join } from "node:path";

const dirname = join(import.meta.dir, "../", "bun-native-bundler-plugin-api");
await Bun.$`rm -rf headers`;
await Bun.$`mkdir -p headers`;
await Bun.$`cp -R ${dirname} headers/bun-native-bundler-plugin-api`;
await Bun.$`bindgen wrapper.h --rustified-enum BunLogLevel --rustified-enum BunLoader --blocklist-type '.*pthread.*' --blocklist-type '__darwin.*' --blocklist-var '__DARWIN.*' --blocklist-type timespec --blocklist-function 'pthread_.*' --no-layout-tests -o src/sys.rs -- -I./headers`;
