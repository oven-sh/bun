// A method of an abstract class calls two abstract methods on this. Three concrete classes define them, one through its parent. Then one definition is deleted, which leaves nothing to call, and the abstract class itself gets a method under that name. One number is printed.
abstract class Report {
  abstract head(): number;
  abstract body(): number;
  render(): number {
    return this.head() * 100 + this.body();
  }
}
class Short extends Report {
  head(): number {
    return 1;
  }
  body(): number {
    return 2;
  }
}
class Long extends Report {
  pages = 30;
  head(): number {
    return 3;
  }
  body(): number {
    return this.pages;
  }
}
class Longer extends Long {
  body(): number {
    return super.body() + 1;
  }
}

function renderAll(reports: Report[]): number {
  let sum = 0;
  for (const report of reports) sum = sum * 1000 + report.render();
  return sum;
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const reports: Report[] = [new Short(), new Long(), new Longer()];
note(renderAll(reports));
Reflect.deleteProperty(Short.prototype, "body");
note(attempt(() => renderAll(reports)));
note(renderAll([reports[1], reports[2]]));
Report.prototype.body = () => 9;
note(renderAll(reports));
Reflect.deleteProperty(Long.prototype, "body");
note(renderAll(reports));
console.log(checksum);

export {};
