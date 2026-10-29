const other: any = { key: 2 };
const made: any = { key: 1, ...other };
try { Object.defineProperty(made, "key", { value: 6 }); console.log(made.key, JSON.stringify(Object.getOwnPropertyDescriptor(made, "key"))); } catch (error) { console.log("threw", String(error)); }
