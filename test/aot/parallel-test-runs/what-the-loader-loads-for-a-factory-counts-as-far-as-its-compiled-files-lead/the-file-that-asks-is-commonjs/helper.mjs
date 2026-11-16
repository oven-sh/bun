let first;
let second;
export const gateOfFirst = new Promise(done => {
  first = done;
});
export const gateOfSecond = new Promise(done => {
  second = done;
});
export const openFirst = () => first();
export const openSecond = () => second();
