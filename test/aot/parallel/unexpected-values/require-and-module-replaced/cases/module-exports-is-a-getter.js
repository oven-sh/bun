var reads = 0;
Object.defineProperty(module, "exports", {
  get: function () {
    reads++;
    return { name: "from a getter", reads: reads };
  },
});
