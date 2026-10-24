// Members of a built-in object that nothing names: the object goes to a timer as an argument and comes back as a value nobody knows; each member is taken out of its own values under a name put together at run time, and used.
const never = process.argv.length > 99;
const glue = (...parts) => parts.join(never ? "x" : "");
setTimeout(async u => {
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('h', 'ypot')]?.value; r = f === undefined ? "absent" : String(f(3, 4)); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Math.hypot', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('c', 'lz32')]?.value; r = f === undefined ? "absent" : String(f(1)); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Math.clz32', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('f', 'round')]?.value; r = f === undefined ? "absent" : String(f(1.5)); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Math.fround', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('s', 'umPrecise')]?.value; r = f === undefined ? "absent" : String(f([1, 2])); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Math.sumPrecise', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('f', '16round')]?.value; r = f === undefined ? "absent" : String(f(1.5)); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('Math.f16round', r);
  }
}, 0, Math);
