let seen = 0;
function Tag() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  seen += new.target === undefined ? 100 : work;
}
function run(count) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  for (let i = 0; i < count; i++) new Tag();
  Tag();
  return seen + work - 1;
}
console.log(run(JSON.parse("3")));
