// The fields and the pop-up of `<input type=date>` and its like.
const millisecondsPerField = { minute: 60000, second: 1000, millisecond: 1 };

const core = require("internal/desktop/dom/core");
const html = require("internal/desktop/dom/html");
const interactive = require("internal/desktop/dom/interactive");
const { styleOf } = require("internal/desktop/dom/cssom");

const { getAttr, setState, states } = core;
type N = $Dom.N;
type Tools = {
  part(host: N, parent: N, pseudo: string): N;
  setText(text: N, data: string): void;
  changed(node: N): void;
};

const DAY = 86400000;
const INCOMPLETE = "?";
const pad = (value: number, length: number) => String(value).padStart(length, "0");
const utc = (year: number, month: number, day: number) => new Date(0).setUTCFullYear(year, month, day);

class Field {
  kind: string;
  min: number;
  max: number;
  placeholder: string;
  names: string[] | null;
  node: N;
  text: N;
  value = NaN;
  constructor(kind: string, min: number, max: number, placeholder: string, names: string[] | null, node: N) {
    this.kind = kind;
    this.min = min;
    this.max = max;
    this.placeholder = placeholder;
    this.names = names;
    this.node = node;
    this.text = core.append(node, core.createText(node.doc, ""));
  }
  label(): string {
    const { value, names, placeholder } = this;
    return value !== value ? placeholder : names !== null ? names[value - this.min] : pad(value, placeholder.length);
  }
}

class DateFields {
  /** The `Input`. */
  it: any;
  tools: Tools;
  locale: string;
  fields: Field[] = [];
  active = 0;
  typed = "";
  /** What the fields stand for. */
  shown: string | null = null;
  picker: N;
  /** The first day of the month in the calendar. */
  month = 0;
  actions = new Map<N, () => void>();

  constructor(it: any, root: N, tools: Tools) {
    const { node, type } = it;
    this.it = it;
    this.tools = tools;
    this.locale = node.doc.page?.environment.languages?.[0] ?? "en-US";
    const container = tools.part(node, root, "-internal-datetime-container");
    const wrapper = tools.part(
      node,
      tools.part(node, container, "-webkit-datetime-edit"),
      "-webkit-datetime-edit-fields-wrapper",
    );
    tools.part(node, container, "-webkit-calendar-picker-indicator");
    this.picker = tools.part(node, root, "-internal-date-picker");
    const step = it.step();
    const precise = [it.text, getAttr(node, "min") ?? ""].join(" ");
    const hasFraction = step % 1000 > 0 || /\.\d/.test(precise);
    const hasSeconds = hasFraction || step % 60000 > 0 || /:\d\d:(?!00)/.test(precise);
    const date = { year: "numeric", month: "2-digit", day: "2-digit" };
    const time = {
      hour: "2-digit",
      minute: "2-digit",
      second: hasSeconds ? "2-digit" : undefined,
      fractionalSecondDigits: hasFraction ? 3 : undefined,
    };
    const options =
      type === "date"
        ? date
        : type === "time"
          ? time
          : type === "month"
            ? { year: "numeric", month: "long" }
            : { ...date, ...time };
    const format = this.format(options);
    const hours = { h11: [0, 11], h12: [1, 12], h23: [0, 23], h24: [1, 24] }[
      format.resolvedOptions().hourCycle ?? "h23"
    ];
    const parts =
      type === "week"
        ? [{ type: "literal", value: "Week " }, { type: "week" }, { type: "literal", value: ", " }, { type: "year" }]
        : format.formatToParts(0);
    const isNumeric = type === "date" || type === "datetime-local";
    for (const { type: kind, value } of parts as any[]) {
      const add = (name: string, min: number, max: number, placeholder: string, names: string[] | null = null) =>
        this.fields.push(
          new Field(
            name,
            min,
            max,
            placeholder,
            names,
            tools.part(node, wrapper, `-webkit-datetime-edit-${name}-field`),
          ),
        );
      if (kind === "year") add(kind, 1, 275760, isNumeric ? "yyyy" : "----");
      else if (kind === "month" && isNumeric) add(kind, 1, 12, "mm");
      else if (kind === "month")
        add(
          kind,
          1,
          12,
          "---------",
          this.names({ month: "long" }, 12, i => utc(2000, i, 1)),
        );
      else if (kind === "day") add(kind, 1, 31, "dd");
      else if (kind === "week") add(kind, 1, 53, "--");
      else if (kind === "hour") add(kind, hours[0], hours[1], "--");
      else if (kind === "minute" || kind === "second") add(kind, 0, 59, "--");
      else if (kind === "fractionalSecond") add("millisecond", 0, 999, "---");
      else if (kind === "dayPeriod") {
        add(
          "ampm",
          0,
          1,
          "--",
          [0, DAY / 2].map(at => format.formatToParts(at).find(it => it.type === kind)!.value),
        );
      } else this.label(tools.part(node, wrapper, "-webkit-datetime-edit-text"), value.replace(/ /g, " "));
    }
  }

  format(options: object) {
    return new Intl.DateTimeFormat(this.locale, {
      ...options,
      timeZone: "UTC",
      calendar: "gregory",
      numberingSystem: "latn",
    });
  }

  names(options: object, count: number, at: (index: number) => number): string[] {
    const format = this.format(options);
    return Array.from({ length: count }, (_, index) => format.format(at(index)));
  }

  label(parent: N, text: string): N {
    core.append(parent, core.createText(parent.doc, text));
    return parent;
  }

  field(kind: string): Field | undefined {
    return this.fields.find(it => it.kind === kind);
  }

  render() {
    const { node, text } = this.it;
    if (text !== this.shown) this.read((this.shown = text));
    for (let i = 0; i < this.fields.length; i++) {
      this.tools.setText(this.fields[i].text, this.fields[i].label());
      setState(this.fields[i].node, states.FOCUS, i === this.active && node.doc.focused === node);
    }
  }

  read(text: string) {
    const numbers = (text.replace(/\.(\d+)$/, (_, digits) => "." + digits.padEnd(3, "0")).match(/\d+/g) ?? []).map(
      Number,
    );
    const kinds = this.kinds();
    for (const field of this.fields) {
      const value = text === "" ? NaN : (numbers[kinds.indexOf(field.kind === "ampm" ? "hour" : field.kind)] ?? 0);
      if (field.kind === "ampm") field.value = Math.floor(value / 12);
      else if (field.kind !== "hour") field.value = value;
      else field.value = value % (field.max - field.min + 1) || (value === value ? field.min * field.max : NaN);
    }
  }

  /** In the order of the value. */
  kinds(): string[] {
    const { type } = this.it;
    const date =
      type === "time"
        ? []
        : type === "week"
          ? ["year", "week"]
          : type === "month"
            ? ["year", "month"]
            : ["year", "month", "day"];
    return type === "time" || type === "datetime-local" ? [...date, "hour", "minute", "second", "millisecond"] : date;
  }

  write() {
    const { it, fields } = this;
    const before = it.value();
    let text = fields.every(field => field.value !== field.value) ? "" : INCOMPLETE;
    if (fields.every(field => field.value === field.value)) {
      const prefixes = {
        month: "-",
        day: "-",
        week: "-W",
        hour: it.type === "time" ? "" : "T",
        minute: ":",
        second: ":",
        millisecond: ".",
      };
      text = "";
      for (const kind of this.kinds()) {
        const field = this.field(kind);
        if (field === undefined) continue;
        const value =
          kind === "hour"
            ? (field.value % (field.max - field.min + 1)) + 12 * (this.field("ampm")?.value ?? 0)
            : field.value;
        text += (prefixes[kind] ?? "") + pad(value, kind === "year" ? 4 : kind === "millisecond" ? 3 : 2);
      }
      text = it.sanitize(text) || INCOMPLETE;
    }
    this.set((this.shown = text), before);
  }

  set(text: string, before: string) {
    const { it } = this;
    it.setFromScript(text);
    it.render();
    if (it.value() !== before) this.tools.changed(it.node);
  }

  activate(index: number): boolean {
    if (index < 0 || index >= this.fields.length) return false;
    this.active = index;
    this.typed = "";
    this.render();
    return true;
  }

  type(key: string): boolean {
    const field = this.fields[this.active];
    if (field.names !== null && !(field.kind === "month" && /\d/.test(key))) {
      const find = (prefix: string) => field.names!.findIndex(name => name.toLowerCase().startsWith(prefix));
      if (find((this.typed += key.toLowerCase())) < 0) this.typed = key.toLowerCase();
      if (find(this.typed) < 0) return false;
      field.value = field.min + find(this.typed);
      this.write();
      return true;
    }
    if (!/^\d$/.test(key)) return false;
    if (+(this.typed += key) > field.max) this.typed = key;
    const value = +this.typed;
    field.value = value >= field.min ? value : NaN;
    this.write();
    if (value * 10 > field.max || this.typed.length >= String(field.max).length) {
      if (!this.activate(this.active + 1)) this.typed = "";
    }
    return true;
  }

  handleKey({ key, altKey, ctrlKey, metaKey, shiftKey }: any): boolean {
    const field = this.fields[this.active];
    if (this.isOpen() && (key === "Escape" || key === "Enter")) return (this.setOpen(false), true);
    if (key === "Tab") return (this.setOpen(false), this.activate(this.active + (shiftKey ? -1 : 1)));
    if (key === "ArrowLeft" || key === "ArrowRight")
      return (this.activate(this.active + (key === "ArrowLeft" ? -1 : 1)), true);
    if (!this.it.isMutable() || ctrlKey || metaKey) return false;
    if (key === "F4" || key === " " || (altKey && key === "ArrowDown")) return (this.setOpen(!this.isOpen()), true);
    if (key === "ArrowUp" || key === "ArrowDown") {
      const { min, max, value, kind } = field;
      const unit = millisecondsPerField[kind] ?? NaN;
      const step = (max + 1) % (this.it.step() / unit) === 0 ? Math.max(1, this.it.step() / unit) : 1;
      const isUp = key === "ArrowUp";
      const next = isUp ? (Math.floor(value / step) + 1) * step : (Math.ceil(value / step) - 1) * step;
      const [first, last] = [min, max - ((max - min) % step)];
      if (value !== value) field.value = kind === "year" ? new Date().getFullYear() : isUp ? first : last;
      else field.value = next > max ? first : next < min ? last : next;
    } else if (key === "Backspace" || key === "Delete") field.value = NaN;
    else return key.length === 1 && !altKey && this.type(key);
    this.typed = "";
    this.write();
    return true;
  }

  handle(event: any, origin: N): boolean {
    if (event.type === "keydown") return this.handleKey(event);
    if (event.type !== "mousedown" || event.button !== 0) return false;
    for (let at: N | null = origin; at !== null; at = at.parent) {
      const action = this.actions.$get(at);
      if (action !== undefined) return (action(), false);
    }
    if (origin.rare?.pseudo === "-webkit-calendar-picker-indicator") this.setOpen(!this.isOpen());
    else if (!core.containsFlat(this.picker, origin)) {
      this.setOpen(false);
      const isBefore = (field: Field) => html.boundingRect(field.node)[0] <= event.clientX;
      this.activate(Math.max(0, this.fields.findLastIndex(isBefore)));
    }
    return false;
  }

  isOpen(): boolean {
    return this.it.node.doc.page?.openPicker?.node === this.it.node;
  }

  setOpen(open: boolean) {
    const { node } = this.it;
    const { picker } = this;
    const page = node.doc.page;
    if (!page || open === this.isOpen() || (open && !this.it.isMutable())) return;
    setState(node, states.PICKER_OPEN, open);
    interactive.setInTopLayer(picker, open);
    page.openPicker = open ? { node, close: () => this.setOpen(false) } : null;
    if (open) {
      const now = new Date();
      this.month = utc(
        this.field("year")?.value || now.getFullYear(),
        (this.field("month")?.value || now.getMonth() + 1) - 1,
        1,
      );
    }
    this.fill(open);
    if (!open) return;
    const [left, top, , height] = html.boundingRect(node);
    const size = html.boundingRect(picker);
    const y = top + height + size[3] > page.height && top > size[3] ? top - size[3] : top + height;
    styleOf(picker).cssText = `left:${Math.max(0, Math.min(left, page.width - size[2]))}px;top:${y}px`;
  }

  button(parent: N, pseudo: string, text: string, action: (() => void) | null): N {
    const made = this.label(
      this.tools.part(this.it.node, parent, "-internal-date-picker-" + (action === null ? "disabled" : pseudo)),
      text,
    );
    if (action !== null) this.actions.$set(made, action);
    return made;
  }

  fill(open = true) {
    const { it, picker } = this;
    this.actions.$clear();
    while (picker.first !== null) core.remove(picker.first, true);
    if (!open) return;
    if (it.type !== "time") this.fillCalendar(this.tools.part(it.node, picker, "-internal-date-picker-calendar"));
    const now = new Date();
    for (const field of this.fields) {
      if (!/^(?:hour|minute|second|ampm)$/.test(field.kind)) continue;
      const column = this.tools.part(it.node, picker, "-internal-date-picker-column");
      for (let value = field.min; value <= field.max; value++) {
        const label = field.names?.[value] ?? pad(value, 2);
        const cell = this.button(column, value === field.value ? "chosen" : "cell", label, () =>
          this.choose({ [field.kind]: value }, now),
        );
        if (value === field.value) html.scrollIntoView(cell, 3, 3, 1, true);
      }
    }
  }

  /** What is empty is taken from `now`. */
  choose(values: Record<string, number>, now: Date) {
    const before = this.fields.map(field => field.value);
    this.read(
      new Date(+now - now.getTimezoneOffset() * 60000).toISOString().slice(this.it.type === "time" ? 11 : 0, 16),
    );
    this.fields.forEach(
      (field, i) => (field.value = values[field.kind] ?? (before[i] === before[i] ? before[i] : field.value)),
    );
    this.write();
    if (this.isOpen()) this.fill();
  }

  fillCalendar(calendar: N) {
    const { it, tools } = this;
    const { node, type } = it;
    const first = new Date(this.month);
    const [year, month] = [first.getUTCFullYear(), first.getUTCMonth()];
    const byYear = type === "month";
    const show = (months: number) => () => {
      this.month = utc(year, month + months, 1);
      this.fill();
    };
    const head = tools.part(node, calendar, "-internal-date-picker-row");
    this.label(
      tools.part(node, head, "-internal-date-picker-title"),
      this.format({ year: "numeric", month: byYear ? undefined : "long" }).format(first),
    );
    this.button(head, "step", "↑", show(byYear ? -12 : -1));
    this.button(head, "step", "↓", show(byYear ? 12 : 1));
    const value: string = it.value();
    const now = new Date();
    const today = utc(now.getFullYear(), now.getMonth(), now.getDate());
    const valueOf = (day: number): string =>
      type === "week" ? it.format(day) : new Date(day).toISOString().slice(0, byYear ? 7 : 10);
    const pick = (day: number) => {
      const text = valueOf(day);
      const [min, max] = ["min", "max"].map(name => it.sanitize(getAttr(node, name) ?? "").slice(0, text.length));
      if (text < min || (max !== "" && text > max)) return null;
      return () => {
        const date = new Date(day);
        if (type === "datetime-local") {
          return this.choose(
            { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() },
            now,
          );
        }
        this.setOpen(false);
        this.set(text, value);
      };
    };
    const grid = tools.part(node, calendar, byYear ? "-internal-date-picker-months" : "-internal-date-picker-days");
    const cell = (text: string, day: number, isOutside: boolean) => {
      const isToday = byYear ? valueOf(day) === valueOf(today) : day === today;
      this.button(
        grid,
        value.startsWith(valueOf(day)) ? "chosen" : isToday ? "today" : isOutside ? "outside" : "cell",
        text,
        pick(day),
      );
    };
    if (byYear)
      this.names({ month: "short" }, 12, i => utc(year, i, 1)).forEach((name, i) => cell(name, utc(year, i, 1), false));
    else {
      const firstDay = type === "week" ? 1 : ((new Intl.Locale(this.locale) as any).getWeekInfo?.().firstDay ?? 7);
      const start = this.month - ((first.getUTCDay() - firstDay + 14) % 7) * DAY;
      for (const name of this.names({ weekday: "short" }, 7, i => start + i * DAY)) {
        this.label(tools.part(node, grid, "-internal-date-picker-label"), name.slice(0, 2));
      }
      for (let day = start; day < start + 42 * DAY; day += DAY) {
        cell(String(new Date(day).getUTCDate()), day, new Date(day).getUTCMonth() !== month);
      }
    }
    const foot = tools.part(node, calendar, "-internal-date-picker-row");
    this.button(foot, "link", "Clear", () => (this.setOpen(false), this.set("", value)));
    this.button(foot, "link", byYear ? "This month" : type === "week" ? "This week" : "Today", pick(today));
  }
}

export default { DateFields };
