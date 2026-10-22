const table = {
  work(value) {
    return value + 1;
  },
};
for (const key of Object.keys(table)) console.log(table[key](1.5));
