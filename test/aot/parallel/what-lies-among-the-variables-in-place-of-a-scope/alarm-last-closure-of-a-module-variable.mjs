let stop = null;
function start(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const former = stop;
  if (former !== null) work = former();
  const size = (n + work) | 0;
  stop = () => size * 2;
  return work;
}
console.log(start(JSON.parse("5")), stop());
