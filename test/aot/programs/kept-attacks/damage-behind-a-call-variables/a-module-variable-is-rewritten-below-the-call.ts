// A typed function reads variables of the module, makes a call and reads them again. Below the call they get other values: ones that fit their types, from typed code and through a closure that was handed out, and ones that do not.
let count: number = 0;
let label: string = "start";
let flag: boolean = false;
let mode = 0;

const setters: any = {
  count: (value: any) => {
    count = value;
  },
  label: (value: any) => {
    label = value;
  },
  flag: (value: any) => {
    flag = value;
  },
};

function below(): number {
  if (mode === 1) {
    count = count + 1000;
    label = "typed";
    flag = !flag;
  } else if (mode === 2) {
    setters.count(7);
    setters.label("by a closure");
    setters.flag(true);
  } else if (mode === 3) {
    setters.count("seven");
    setters.label(7);
    setters.flag("yes");
  }
  return 1;
}

function holder(): string {
  const before = count + 1 + "," + label.length + "," + (flag ? "on" : "off");
  const got = below();
  return before + " " + got + " " + (count + 1) + "," + label.length + "," + (flag ? "on" : "off") + "," + (flag === true);
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  count = round;
  label = "start";
  flag = false;
  const line = holder();
  if (mode || round === 0) console.log(round + ": " + line);
}
