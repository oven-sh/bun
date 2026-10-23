// Only an ordinary function with a store that something constructs with has a constructor shape: not a generator, an async function or an arrow function.
function P() {
  this.a = 1;
}
function* generator() { this.a = 1; }
async function later() { this.a = 1; }
function plain() { return 1; }
const arrow = () => { this.a = 1; };
function onlyCalled() { this.a = 1; }
new P(), new generator(), new later(), new plain(), new arrow();
onlyCalled.call({});
