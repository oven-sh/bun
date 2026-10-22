const table = {
  work(value) {
    return value + 1;
  },
};
for (const [name, work] of Object.entries(table)) console.log(name, work(1.5));
