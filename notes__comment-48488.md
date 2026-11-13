#48716 is stacked on this branch. It fixes the case that this PR lists as unchanged (a field with a value under `useDefineForClassFields: false`, TS2339 and no `.aot.ts` file).

It puts the member notes of this PR into one table with that case, so it removes `ModuleTypes::members`, `member_type`, `Written::noted_member` and `text_of_types_that_name_nothing`. The tests of this PR pass there with two expectations changed to a type with a name (`Mode | undefined`, `Map<string, number> | undefined`).
