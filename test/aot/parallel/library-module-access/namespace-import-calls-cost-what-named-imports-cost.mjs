// The namespace object of node:fs is only the receiver of calls. The lazy exports of node:fs (promises, the stream classes) are not read, so what they load stays out.
// STATISTIC: ImageFunctionsEmitted <= 200
import * as fs from "node:fs";
console.log(String(fs.existsSync(process.execPath)), String(fs.accessSync(process.execPath)));
