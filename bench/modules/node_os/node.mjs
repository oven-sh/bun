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
