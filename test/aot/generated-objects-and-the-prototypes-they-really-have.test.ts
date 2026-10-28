import {
  callees,
  calls,
  departures,
  handedLists,
  lastSteps,
  late,
  lateMembers,
  listIsHanded,
  lists,
  listTakers,
  livesOfParent,
  lookups,
  madeFor,
  makers,
  memberLeaves,
  membersThatLeave,
  momentsOfDeparture,
  newPrototypes,
  newTargets,
  oneListTwice,
  orders,
  otherQuestions,
  parents,
  places,
  positions,
  questions,
  replaced,
  replacements,
  takenBy,
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

for (const member of Object.keys(membersThatLeave))
  for (const departure of Object.keys(departures))
    for (const moment of Object.keys(momentsOfDeparture))
      for (const otherQuestion of Object.keys(otherQuestions))
        for (const life of Object.keys(livesOfParent))
          add(
            `${member} leaves the prototype of a function that ${life} by ${departure}, ${moment}; super beside ${otherQuestion}`,
            life === "makes no object" &&
              departure !== "another member in its place" &&
              otherQuestion.endsWith("Reflect.get"),
            () => memberLeaves(member, departure, moment, otherQuestion, life),
          );

for (const taker of Object.keys(listTakers))
  for (const callee of Object.keys(takenBy))
    for (const list of Object.keys(handedLists))
      for (const usesResult of [false, true])
        add(
          `${taker} of ${callee} is handed ${list}${usesResult ? ", and the result is used" : ""}`,
          taker.startsWith("Reflect.construct") &&
            callee !== "a built-in" &&
            !/number|string|list|length|array/.test(list),
          () => listIsHanded(taker, callee, list, usesResult),
        );

generated("objects and the prototypes they really have", programs);
