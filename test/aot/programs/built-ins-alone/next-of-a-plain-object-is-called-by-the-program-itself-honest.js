const counter = {
  index: 0,
  next() {
    this.index++;
    return this.index > 2 ? { done: true, value: undefined } : { done: false, value: this.index + 0.5 };
  },
};
for (let step = counter.next(); !step.done; step = counter.next()) console.log(step.value + 1);
console.log(counter.index);
