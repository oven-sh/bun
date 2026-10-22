let runs = 0;
const timer = setTimeout(() => {
  runs++;
  console.log(runs);
}, 1);
console.log(timer.refresh() === timer);
