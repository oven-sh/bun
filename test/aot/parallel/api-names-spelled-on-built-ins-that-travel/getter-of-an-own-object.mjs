const holder = {
  get api() {
    return Bun;
  },
};
console.log(holder.api.escapeHTML("<a>"));
