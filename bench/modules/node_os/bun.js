import { bench, run } from "mitata";
import {
  cpus,
  endianness,
  arch,
  uptime,
  networkInterfaces,
  getPriority,
  totalmem,
  freemem,
  homedir,
  hostname,
  loadavg,
  platform,
  release,
  setPriority,
  tmpdir,
  type,
  userInfo,
  version,
} from "node:os";

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
