function make({ skip, step = 2 }, [first]) {
  let at = first;
  return { go: () => (at += step), skips: () => skip && at, first: () => first };
}
const made = make({ skip: true }, [10]);
console.log(made.go(), made.go(), made.skips(), made.first());
