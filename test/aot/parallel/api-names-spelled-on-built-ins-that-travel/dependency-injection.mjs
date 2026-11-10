class Service {
  constructor(api) {
    this.api = api;
  }
  run() {
    return this.api.escapeHTML("<a>");
  }
}
console.log(new Service(Bun).run());
