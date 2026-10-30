// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.mjs
// Members of a built-in object that nothing names: the object goes to a timer as an argument and comes back as a value nobody knows; each member is taken out of its own values under a name put together at run time, and used.
const never = process.argv.length > 99;
const glue = (...parts) => parts.join(never ? "x" : "");
setTimeout(async u => {
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('n', 'extTick'))?.[1]; r = f === undefined ? "absent" : String(await new Promise(r => f(r, 7))); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.nextTick', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('h', 'rtime')]; r = f === undefined ? "absent" : String(f().length); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.hrtime', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('b', 'inding')]; r = f === undefined ? "absent" : String(typeof f('uv')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.binding', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('s', 'tdout'))?.[1]; r = f === undefined ? "absent" : String(typeof f.write); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.stdout', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('s', 'tderr')]; r = f === undefined ? "absent" : String(typeof f.write); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.stderr', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('s', 'tdin')]; r = f === undefined ? "absent" : String(typeof f.on); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.stdin', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('e', 'mitWarning'))?.[1]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.emitWarning', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('m', 'emoryUsage')]; r = f === undefined ? "absent" : String(typeof f().rss); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.memoryUsage', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('c', 'puUsage'))?.[1]; r = f === undefined ? "absent" : String(typeof f().user); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.cpuUsage', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('r', 'esourceUsage')]; r = f === undefined ? "absent" : String(typeof f().maxRSS); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.resourceUsage', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('u', 'ptime')]; r = f === undefined ? "absent" : String(typeof f()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.uptime', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('r', 'eport'))?.[1]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.report', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('f', 'eatures')]; r = f === undefined ? "absent" : String(typeof f.inspector); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.features', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('c', 'onfig')]; r = f === undefined ? "absent" : String(typeof f.variables); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.config', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('r', 'elease'))?.[1]; r = f === undefined ? "absent" : String(f.name); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.release', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('v', 'ersions')]; r = f === undefined ? "absent" : String(typeof f.bun); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.versions', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('a', 'llowedNodeEnvironmentFlags')]; r = f === undefined ? "absent" : String(typeof f.has); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.allowedNodeEnvironmentFlags', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('c', 'onstrainedMemory'))?.[1]; r = f === undefined ? "absent" : String(typeof f()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.constrainedMemory', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('a', 'vailableMemory')]; r = f === undefined ? "absent" : String(typeof f()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.availableMemory', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('u', 'mask')]; r = f === undefined ? "absent" : String(typeof f()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.umask', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('c', 'wd'))?.[1]; r = f === undefined ? "absent" : String(typeof f()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.cwd', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('g', 'etuid')]; r = f === undefined ? "absent" : String(typeof f()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.getuid', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('t', 'itle')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.title', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('e', 'nv'))?.[1]; r = f === undefined ? "absent" : String(typeof f.PATH); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.env', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('a', 'rgv')]; r = f === undefined ? "absent" : String(f.length > 0); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.argv', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('e', 'xecArgv')]; r = f === undefined ? "absent" : String(f.length); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.execArgv', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('o', 'penStdin'))?.[1]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.openStdin', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('s', 'etSourceMapsEnabled')]; r = f === undefined ? "absent" : String(f(false)); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.setSourceMapsEnabled', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('l', 'oadEnvFile')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.loadEnvFile', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('t', 'hreadCpuUsage'))?.[1]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.threadCpuUsage', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('r', 'ef')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.ref', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('e', 'xitCode')]; r = f === undefined ? "absent" : String(f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('process.exitCode', r);
  }
}, 0, process);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: glue
// CHECK-LABEL: function {{*}}name="glue"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="join"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="never"
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = String string="x"
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = String string=""
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: v11 = Call v2, v0, v10 calleeKey="join" calleeName="parts.join"
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
