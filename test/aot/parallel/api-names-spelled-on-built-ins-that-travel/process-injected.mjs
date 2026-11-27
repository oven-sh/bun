class Service {
  constructor(p) {
    this.p = p;
  }
  run() {
    return [typeof this.p.cpuUsage().user, typeof this.p.uptime(), this.p.report ? typeof this.p.report.getReport().header : "none"].join(" ");
  }
}
console.log(new Service(process).run());
