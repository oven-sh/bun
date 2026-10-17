import {
  arch,
  cpus,
  endianness,
  freemem,
  getPriority,
  homedir,
  hostname,
  loadavg,
  networkInterfaces,
  platform,
  release,
  setPriority,
  tmpdir,
  totalmem,
  type,
  uptime,
  userInfo,
  version,
} from "node:os";
import { bench, run } from "../../runner.mjs";

bench("cpus()", () => cpus());
bench("cpus().length", () => cpus().length);
// os.cpus() is empty on a host that has no CPU information.
if (cpus().length > 0) {
  bench("cpus()[0].times", () => cpus()[0].times);
  bench("cpus()[0].model", () => cpus()[0].model);
}
bench("JSON.stringify(cpus())", () => JSON.stringify(cpus()));
bench("networkInterfaces()", () => networkInterfaces());
bench("arch()", () => arch());
bench("endianness()", () => endianness());
bench("freemem()", () => freemem());
bench("totalmem()", () => totalmem());
bench("getPriority()", () => getPriority());
bench("homedir()", () => homedir());
bench("hostname()", () => hostname());
bench("loadavg()", () => loadavg());
bench("platform()", () => platform());
bench("release()", () => release());
bench("setPriority(2)", () => setPriority(2));
bench("tmpdir()", () => tmpdir());
bench("type()", () => type());
bench("uptime()", () => uptime());
bench("userInfo()", () => userInfo());
bench("version()", () => version());
await run();
