const options = {
  count: 0,
  get status() {
    this.count++;
    console.log("status", this === options);
    return 201;
  },
};
console.log(new Response("a", options).status + 1);
console.log(options.count);
