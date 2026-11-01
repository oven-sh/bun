// The first read of a member adds it to Date.prototype, and from the first copy of the object on its keys stand in that order. toJSON reads valueOf and then toISOString by name, the latter only for a valid date.
const say = (run: () => unknown) => {
  for (let turn = 0; turn < 3; turn++) run();
  console.log(run());
};
say(() => new Date(0).getDay());
say(() => new Date(NaN).toJSON());
say(() => new Date(0).setUTCHours(1));
say(() => new Date(0).toJSON());
say(() => new Date(0).getUTCDay());
say(() => JSON.stringify([new Date(5)]));
say(() => new Date(5).toISOString());
console.log(Object.values(Date.prototype).length);
console.log(Object.getOwnPropertyNames(Date.prototype).join());
