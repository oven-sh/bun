// Templates: a tokenizer, a tree, filters, blocks that are inherited, macros, loops with a state, includes, autoescape, a cache, errors with positions, in two modules
import { Engine } from "./lib";
const engine = new Engine({ base: "<html>{% block title %}Base{% endblock %}|{% block body %}empty{% endblock %}{# note #}</html>",
  page: '{% extends "base" %}{% set mark = "!" %}{% block title %}{{ title|title }}{{ mark }}{% endblock %}{% block body %}{{ parent() }}:{% for k, v in items -%} {{ loop.index }}.{{ k }}={{ v|round(2) }}{% if not loop.last %}, {% endif %}{%- else %}none{% endfor %}{% endblock %}',
  child: '{% extends "page" %}{% block body %}[{{ parent() }}]{% endblock %}',
  macros: '{% macro field(name, kind="text", n=3) %}<i {{ name }}:{{ kind }}{{ n*2 }}>{% endmacro %}{{ field("a") }}{{ field("b", "num", 1) }}{% for u in users|sort("age") %}{{ loop.cycle("odd", "even") }}-{{ u.name|upper|truncate(4) }}{% endfor %}',
  part: "<{{ who|default('nobody') }}{% if deep > 0 %}{% set deep = deep - 1 %}{% include 'part' %}{% endif %}>",
  math: "{{ 1 + 2 * 3 - 4 / 8 }} {{ 7 % 4 ~ 'x' }} {{ (1 < 2) and 'yes' or 'no' }} {{ 2 in [1, 2] ? 'in' : 'out' }} {{ not none }} {{ range(1, 5)|join('-') }} {{ list[1].deep['key'] }} {{ missing.x.y }} {{ html }} {{ html|safe }} {{ [3, 1, 2]|sort|reverse|first }} {{ users|map('age')|sum }}",
  bad1: "line\n{% if x %}open", bad2: "{{ 1 + }}", bad3: "a\nb\n{% nope %}",
  bad4: "{{ x|nofilter }}", bad5: '{% extends "bad5" %}', bad6: "{{ 5() }}" });
const people = Array.from({ length: 12 }, (_, i) => ({ name: "person" + i,
  age: (i * 7) % 31 }));
let total = 0, mixed = 0;
for (let round = 0; round < 250; round++) {
  const vars = {
    title: "hello <world> " + round, items: round % 3 ? {
      x: round / 3, y: round * 1.005, z: 1
  } : [], users: people.slice(round % 5), who: round % 2 ? "w" + round : null, deep: round % 4,
    list: [0, { deep: { key: "k" + round } }], html: "<b>&'\"</b>"
};
  for (const name of ["page", "child", "macros", "part", "math"]) {
    const text = engine.render(name, vars);
    total += text.length;
    mixed = (mixed * 33 + text.charCodeAt(round % text.length)) >>> 0;
    if (round < 2) console.log(name, text);
  }
}
console.log(total, mixed, engine.parsed, engine.rendered);
for (const name of ["bad1", "bad2", "bad3", "bad4", "bad5", "bad6", "none"]) try {
  console.log(engine.render(name, { x: 1 }));
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
