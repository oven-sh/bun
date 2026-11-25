// STATISTIC: ImageFunctionsEmitted <= 8
let rounds = 0;
const bell = setInterval(() => {
  rounds++;
  console.log("rang", rounds);
  if (rounds === 3) clearInterval(bell);
}, 2);
