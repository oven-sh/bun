// Members of a built-in object that nothing names: the object goes to a timer as an argument and comes back as a value nobody knows; each member is taken out of its own values under a name put together at run time, and used.
const never = process.argv.length > 99;
const glue = (...parts) => parts.join(never ? "x" : "");
setTimeout(async u => {
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('t', 'able'))?.[1]; r = f === undefined ? "absent" : String(f([{ a: 1 }])); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('console.table', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('w', 'rite')]; r = f === undefined ? "absent" : String(f('w\n')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('console.write', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('g', 'roup')]; r = f === undefined ? "absent" : String((f('g'), console.groupEnd())); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('console.group', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('d', 'ir'))?.[1]; r = f === undefined ? "absent" : String(f({ a: 1 })); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('console.dir', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('c', 'ount')]; r = f === undefined ? "absent" : String(f('c')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('console.count', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('a', 'ssert')]; r = f === undefined ? "absent" : String(f(false, 'no')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('console.assert', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('t', 'imeLog'))?.[1]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('console.timeLog', r);
  }
  {
  let r; try { const f = ({ ...u })[glue('t', 'race')]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('console.trace', r);
  }
  {
  let r; try { const f = Object.assign({}, u)[glue('d', 'ebug')]; r = f === undefined ? "absent" : String(f('d')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('console.debug', r);
  }
  {
  let r; try { const f = Object.entries(u).find(([k]) => k === glue('w', 'arn'))?.[1]; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('console.warn', r);
  }
}, 0, console);
