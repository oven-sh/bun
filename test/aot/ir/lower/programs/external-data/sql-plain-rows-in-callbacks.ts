// RUN: lower
// OPTIONS: builtin-modules

// The SQLite adapter of Bun.sql creates plain objects. A callback called with rows of sql<Row[]> converts a plain row that matches Row in place at its entry and runs its typed body; a row that does not match runs the untyped clone.
import { SQL } from "bun";

interface Row {
  id: number;
  parentId: number | null;
  body: string;
  login: string;
}
interface Author {
  login: string;
}
interface Comment {
  id: number;
  parentId: number | null;
  author: Author;
  body: string;
}
interface CommentNode extends Comment {
  replies: CommentNode[];
}

const db = new SQL("sqlite://:memory:");
await db`CREATE TABLE comments (id INTEGER PRIMARY KEY, parentId INTEGER, body, login TEXT)`;
await db`INSERT INTO comments VALUES (1, NULL, 'first', 'ann'), (2, 1, '', 'bob'), (3, 1, 'naïve — 日本語', 'ann')`;
await db`CREATE TABLE mismatches (id INTEGER PRIMARY KEY, parentId INTEGER, body, login TEXT)`;
await db`INSERT INTO mismatches VALUES (1, NULL, 'matches', 'ann'), (2, 1, 7, 'bob'), (3, 1, 'no login', NULL)`;

async function commentsOf(): Promise<Comment[]> {
  const rows = await db<Row[]>`SELECT id, parentId, body, login FROM comments ORDER BY id`;
  return rows.map(row => ({ id: row.id, parentId: row.parentId, author: { login: row.login }, body: row.body }));
}

function describe(comments: Comment[]): string {
  let text = "";
  for (const comment of comments) {
    const node: CommentNode = { ...comment, replies: [] };
    text += `${node.id}:${node.parentId}:${node.author.login}:${node.body.length}:${node.replies.length} `;
  }
  return text;
}
console.log(describe(await commentsOf()));

async function inspectMismatches(): Promise<void> {
  const rows = await db<Row[]>`SELECT id, parentId, body, login FROM mismatches ORDER BY id`;
  console.log(rows.map(row => `${row.id}${typeof row.body}${typeof row.login}`).join(), JSON.stringify(rows), Object.keys(rows[0]!).join());
}
await inspectMismatches();

await db.close();
Bun.gc(true);

// GENERATED: commentsOf describe
// CHECK-LABEL: function {{*}}name="commentsOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] syntax=[HasWrittenAwait] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|Array<undefined|null|[[L_1]]>> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="db"
// CHECK-NEXT: v3 = NewTemplateObject templateStrings=[{cooked="SELECT id, parentId, body, login FROM comments ORDER BY id" raw="SELECT id, parentId, body, login FROM comments ORDER BY id"}]
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="db" expectedResult=x0
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_3]]|Promise flags=[IsExpected]}
// CHECK-NEXT: v6 = Await v5
// CHECK-NEXT: v7 = PropGet v6 key="map"
// CHECK-NEXT: v8 = NewClosure function=[[f_4]]
// CHECK-NEXT: v9 = Call v7, v6, v8 calleeKey="map" calleeName="rows.map"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<undefined|null|[[L_1]]> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|object}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_1]]> flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_1]]>):
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b1(v2)
// CHECK-NEXT: b1(v4: undefined|null|string):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v10 = NewObject layout=[[L_5]]
// CHECK-NEXT: CopyDataProperties v10, v8
// CHECK-NEXT: v12 = Data data=[[d_6]]
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|[[L_5]]> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropDefine v10, v13 key="replies"
// CHECK-NEXT: v15 = FinishObject v10
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = PropGet v16 key="id"
// CHECK-NEXT: v18 = ToString v17
// CHECK-NEXT: v19 = String string=":"
// CHECK-NEXT: v20 = PropGet v16 key="parentId"
// CHECK-NEXT: v21 = ToString v20
// CHECK-NEXT: v22 = String string=":"
// CHECK-NEXT: v23 = PropGet v16 key="author"
// CHECK-NEXT: v24 = PropGet v23 key="login"
// CHECK-NEXT: v25 = ToString v24
// CHECK-NEXT: v26 = String string=":"
// CHECK-NEXT: v27 = PropGet v16 key="body"
// CHECK-NEXT: v28 = PropGet v27 key="length"
// CHECK-NEXT: v29 = ToString v28
// CHECK-NEXT: v30 = String string=":"
// CHECK-NEXT: v31 = PropGet v16 key="replies"
// CHECK-NEXT: v32 = PropGet v31 key="length"
// CHECK-NEXT: v33 = ToString v32
// CHECK-NEXT: v34 = String string=" "
// CHECK-NEXT: v35 = Strcat v18, v19, v21, v22, v25, v26, v29, v30, v33, v34
// CHECK-NEXT: v36 = Add v4, v35
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b1(v37)
// CHECK-NEXT: b5() role=IterationCleanup subject=v3:
// CHECK-NEXT: v38 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v38
// CHECK-NEXT: }
