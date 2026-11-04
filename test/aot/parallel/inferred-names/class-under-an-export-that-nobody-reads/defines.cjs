Object.defineProperty(exports, "read", { enumerable: true, value: 1 });
Object.defineProperty(exports, "unread", {
  enumerable: true,
  value: class {
    static told = console.log("defined:", JSON.stringify(this.name));
  },
});
