// again.mjs passes on all of node:fs. Its namespace object is only the receiver of calls: the lazy exports of node:fs (promises, the stream classes) are not read, so what they load stays out.
// STATISTIC: ImageFunctionsEmitted <= 200 Todo: what this program reaches of Bun's library is not cut down to what it uses yet
import * as all from "./again.mjs";
console.log(String(all.existsSync(process.execPath)), String(all.accessSync(process.execPath)));
