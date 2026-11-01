// The first read of a member adds it to Date.prototype, and from the first copy of the object on its keys stand in that order. Writing a date reads toJSON, valueOf and toISOString by name.
const say = (run: () => unknown) => {
  for (let turn = 0; turn < 3; turn++) run();
  console.log(run());
};
type Row = { when: Date };
const row: Row = { when: new Date(5) };
say(() => new Date(1).getDay());
say(() => JSON.stringify(row));
say(() => new Date(1).getUTCDay());
say(() => `${new Date(1)}`.length);
say(() => new Date(1).getHours());
console.log(Object.values(Date.prototype).length);
console.log(Object.getOwnPropertyNames(Date.prototype).join());
