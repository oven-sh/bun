import { functions, textOf } from "./generated/built-ins-called-as-members-of-a-table";
import { generated } from "./generated/run-generated";
import { schedules } from "./harness/flow-schedules";

generated(
  "a function of the language is called under another name as a member of a table",
  functions.flatMap(([holder, member, operands]) =>
    [false, true].flatMap(tableLeaves =>
      Object.entries(schedules).map(([schedule, flags]) => ({
        name: `${holder}.${member}, the table ${tableLeaves ? "has left" : "stays"}, the ${schedule} schedule`,
        isAlwaysRun: schedule === "usual" && (member === "from" || member === "groupBy"),
        isOnlyCompiled: true as const,
        flags,
        make: () => ({ file: "main.mjs", text: textOf(holder, member, operands, tableLeaves) }),
      })),
    ),
  ),
);
