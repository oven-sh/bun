// console.dir reads showHidden of its options, and nothing else in this program reads that getter: the executable keeps it.
class Options {
  get showHidden() {
    console.log("showHidden is read");
    return true;
  }
}
const value = { shown: 1 };
Object.defineProperty(value, "hidden", { value: 2, enumerable: false });
console.dir(value, new Options());
console.dir(value, { showHidden: false });
