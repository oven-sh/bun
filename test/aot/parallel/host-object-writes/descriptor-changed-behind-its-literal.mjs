// Neither descriptor still asks for what its literal lists: each definition leaves the member as it is, and no build stops on it.
const stored = { value: () => 7 };
stored.value = Date.prototype.getTime;
Object.defineProperty(Date.prototype, "getTime", stored);
const deleted = { value: () => 7 };
delete deleted.value;
Object.defineProperty(Date.prototype, "getDate", deleted);
console.log(new Date(0).getTime(), typeof new Date(0).getDate());
