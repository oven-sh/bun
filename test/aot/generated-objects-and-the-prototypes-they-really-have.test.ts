import {
  callees,
  calls,
  lastSteps,
  late,
  lateMembers,
  lists,
  lookups,
  madeFor,
  makers,
  newPrototypes,
  newTargets,
  oneListTwice,
  orders,
  parents,
  places,
  positions,
  questions,
  replaced,
  replacements,
} from "./generated/objects-and-the-prototypes-they-really-have";
import { generated, type Generated } from "./generated/run-generated";

const programs: Generated[] = [];
const add = (name: string, wasOnceWrong: boolean, make: Generated["make"]) =>
  programs.push({ name, isAlwaysRun: wasOnceWrong, wasOnceWrong, isOnlyCompiled: true, make });

for (const maker of Object.keys(makers))
  for (const newTarget of Object.keys(newTargets))
    for (const question of Object.keys(questions))
      for (const place of Object.keys(places))
        if (maker !== "a function" || newTarget !== "a class below")
          add(
            `${maker} makes an object for ${newTarget}, ${place}: ${question}`,
            maker !== "a function" &&
              ["a function", "a function without members", "a function whose prototype is null"].includes(newTarget) &&
              ["a getter", "a store", "in"].includes(question) &&
              ["between two questions to an instance", "in turns with the maker itself"].includes(place),
            () => madeFor(maker, newTarget, question, place),
          );

for (const newPrototype of Object.keys(newPrototypes))
  for (const replacement of Object.keys(replacements))
    for (const lookup of Object.keys(lookups))
      for (const order of Object.keys(orders))
        if (replacement === "a store" || newPrototype.endsWith("the members"))
          add(
            `a function gets ${newPrototype} by ${replacement}; ${order}: ${lookup}`,
            order === "an object is made, the prototype is replaced, the class is defined" && lookup.endsWith("super"),
            () => replaced(newPrototype, replacement, lookup, order),
          );

for (const lateMember of Object.keys(lateMembers))
  for (const parent of Object.keys(parents))
    for (const lastStep of Object.keys(lastSteps))
      for (const makesObjectFirst of [false, true])
        add(
          `${lateMember} comes late to ${parent} of a function${makesObjectFirst ? " that has made an object" : ""}; ${lastStep}`,
          lastStep === "the class gets another parent",
          () => late(lateMember, parent, lastStep, makesObjectFirst),
        );

for (const callee of Object.keys(callees))
  for (const list of Object.keys(lists))
    for (const call of Object.keys(calls))
      for (const position of Object.keys(positions))
        add(
          `${list} is the receiver and the list of ${call} of ${callee}, ${position}`,
          list.startsWith("arguments") &&
            ["apply", "Reflect.apply"].includes(call) &&
            ["as an argument", "in a try", "twice"].includes(position),
          () => oneListTwice(callee, list, call, position),
        );

generated("objects and the prototypes they really have", programs);
