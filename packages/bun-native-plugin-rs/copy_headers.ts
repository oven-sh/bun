import { join } from "node:path";

const dirname = join(import.meta.dir, "../", "bun-native-bundler-plugin-api");
await Bun.$`rm -rf headers`;
await Bun.$`mkdir -p headers`;
await Bun.$`cp -R ${dirname} headers/bun-native-bundler-plugin-api`;
