// RUN: lower
// OPTIONS: builtin-modules

// Two roads to one module, one probe of many. It prints what plain Bun prints.
import * as space from "node:os";
import whole from "node:os";
import { EOL as named_EOL, arch as named_arch, availableParallelism as named_availableParallelism, constants as named_constants, cpus as named_cpus, devNull as named_devNull, endianness as named_endianness, freemem as named_freemem, getPriority as named_getPriority, homedir as named_homedir, hostname as named_hostname, loadavg as named_loadavg, machine as named_machine, networkInterfaces as named_networkInterfaces, platform as named_platform, release as named_release, setPriority as named_setPriority, tmpdir as named_tmpdir, totalmem as named_totalmem, type as named_type, uptime as named_uptime, userInfo as named_userInfo, version as named_version } from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:os");
const asked = process.getBuiltinModule("node:os");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("EOL", named_EOL === space.EOL, named_EOL === whole.EOL, named_EOL === required.EOL, named_EOL === asked.EOL, space.EOL === required.EOL, whole.EOL === required.EOL, asked.EOL === required.EOL, whole.EOL === space.EOL);
same("arch", named_arch === space.arch, named_arch === whole.arch, named_arch === required.arch, named_arch === asked.arch, space.arch === required.arch, whole.arch === required.arch, asked.arch === required.arch, whole.arch === space.arch);
same("availableParallelism", named_availableParallelism === space.availableParallelism, named_availableParallelism === whole.availableParallelism, named_availableParallelism === required.availableParallelism, named_availableParallelism === asked.availableParallelism, space.availableParallelism === required.availableParallelism, whole.availableParallelism === required.availableParallelism, asked.availableParallelism === required.availableParallelism, whole.availableParallelism === space.availableParallelism);
same("constants", named_constants === space.constants, named_constants === whole.constants, named_constants === required.constants, named_constants === asked.constants, space.constants === required.constants, whole.constants === required.constants, asked.constants === required.constants, whole.constants === space.constants);
same("cpus", named_cpus === space.cpus, named_cpus === whole.cpus, named_cpus === required.cpus, named_cpus === asked.cpus, space.cpus === required.cpus, whole.cpus === required.cpus, asked.cpus === required.cpus, whole.cpus === space.cpus);
same("devNull", named_devNull === space.devNull, named_devNull === whole.devNull, named_devNull === required.devNull, named_devNull === asked.devNull, space.devNull === required.devNull, whole.devNull === required.devNull, asked.devNull === required.devNull, whole.devNull === space.devNull);
same("endianness", named_endianness === space.endianness, named_endianness === whole.endianness, named_endianness === required.endianness, named_endianness === asked.endianness, space.endianness === required.endianness, whole.endianness === required.endianness, asked.endianness === required.endianness, whole.endianness === space.endianness);
same("freemem", named_freemem === space.freemem, named_freemem === whole.freemem, named_freemem === required.freemem, named_freemem === asked.freemem, space.freemem === required.freemem, whole.freemem === required.freemem, asked.freemem === required.freemem, whole.freemem === space.freemem);
same("getPriority", named_getPriority === space.getPriority, named_getPriority === whole.getPriority, named_getPriority === required.getPriority, named_getPriority === asked.getPriority, space.getPriority === required.getPriority, whole.getPriority === required.getPriority, asked.getPriority === required.getPriority, whole.getPriority === space.getPriority);
same("homedir", named_homedir === space.homedir, named_homedir === whole.homedir, named_homedir === required.homedir, named_homedir === asked.homedir, space.homedir === required.homedir, whole.homedir === required.homedir, asked.homedir === required.homedir, whole.homedir === space.homedir);
same("hostname", named_hostname === space.hostname, named_hostname === whole.hostname, named_hostname === required.hostname, named_hostname === asked.hostname, space.hostname === required.hostname, whole.hostname === required.hostname, asked.hostname === required.hostname, whole.hostname === space.hostname);
same("loadavg", named_loadavg === space.loadavg, named_loadavg === whole.loadavg, named_loadavg === required.loadavg, named_loadavg === asked.loadavg, space.loadavg === required.loadavg, whole.loadavg === required.loadavg, asked.loadavg === required.loadavg, whole.loadavg === space.loadavg);
same("machine", named_machine === space.machine, named_machine === whole.machine, named_machine === required.machine, named_machine === asked.machine, space.machine === required.machine, whole.machine === required.machine, asked.machine === required.machine, whole.machine === space.machine);
same("networkInterfaces", named_networkInterfaces === space.networkInterfaces, named_networkInterfaces === whole.networkInterfaces, named_networkInterfaces === required.networkInterfaces, named_networkInterfaces === asked.networkInterfaces, space.networkInterfaces === required.networkInterfaces, whole.networkInterfaces === required.networkInterfaces, asked.networkInterfaces === required.networkInterfaces, whole.networkInterfaces === space.networkInterfaces);
same("platform", named_platform === space.platform, named_platform === whole.platform, named_platform === required.platform, named_platform === asked.platform, space.platform === required.platform, whole.platform === required.platform, asked.platform === required.platform, whole.platform === space.platform);
same("release", named_release === space.release, named_release === whole.release, named_release === required.release, named_release === asked.release, space.release === required.release, whole.release === required.release, asked.release === required.release, whole.release === space.release);
same("setPriority", named_setPriority === space.setPriority, named_setPriority === whole.setPriority, named_setPriority === required.setPriority, named_setPriority === asked.setPriority, space.setPriority === required.setPriority, whole.setPriority === required.setPriority, asked.setPriority === required.setPriority, whole.setPriority === space.setPriority);
same("tmpdir", named_tmpdir === space.tmpdir, named_tmpdir === whole.tmpdir, named_tmpdir === required.tmpdir, named_tmpdir === asked.tmpdir, space.tmpdir === required.tmpdir, whole.tmpdir === required.tmpdir, asked.tmpdir === required.tmpdir, whole.tmpdir === space.tmpdir);
same("totalmem", named_totalmem === space.totalmem, named_totalmem === whole.totalmem, named_totalmem === required.totalmem, named_totalmem === asked.totalmem, space.totalmem === required.totalmem, whole.totalmem === required.totalmem, asked.totalmem === required.totalmem, whole.totalmem === space.totalmem);
same("type", named_type === space.type, named_type === whole.type, named_type === required.type, named_type === asked.type, space.type === required.type, whole.type === required.type, asked.type === required.type, whole.type === space.type);
same("uptime", named_uptime === space.uptime, named_uptime === whole.uptime, named_uptime === required.uptime, named_uptime === asked.uptime, space.uptime === required.uptime, whole.uptime === required.uptime, asked.uptime === required.uptime, whole.uptime === space.uptime);
same("userInfo", named_userInfo === space.userInfo, named_userInfo === whole.userInfo, named_userInfo === required.userInfo, named_userInfo === asked.userInfo, space.userInfo === required.userInfo, whole.userInfo === required.userInfo, asked.userInfo === required.userInfo, whole.userInfo === space.userInfo);
same("version", named_version === space.version, named_version === whole.version, named_version === required.version, named_version === asked.version, space.version === required.version, whole.version === required.version, asked.version === required.version, whole.version === space.version);

// GENERATED: same
// CHECK-LABEL: function {{*}}name="same"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}, {type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = PropGet v1 key="map"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v11 = NewClosure function=[[f_2]]
// CHECK-NEXT: v12 = Call v10, v1, v11 calleeKey="map" calleeName="answers.map"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|"F"|"T"> flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="join"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v16 = String string=""
// CHECK-NEXT: v17 = Call v15, v13, v16 calleeKey="join" calleeName="join"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = Add v8, v18
// CHECK-NEXT: v20 = Call v6, v4, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
