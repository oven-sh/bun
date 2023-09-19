import * as Bun from 'bun'
import * as fs from 'fs';
import * as path from 'path';

function fromDir(directory: string, filter: string): string[] {
  if (!fs.existsSync(directory)) return

  const files: string[] = []

  for (const file of fs.readdirSync(directory)) {
      var filename = path.join(directory, file);

      if (fs.lstatSync(filename).isDirectory()) files.push(...fromDir(filename, filter))
      else if (filename.endsWith(filter)) files.push(filename)
  };

  return files
};

const files = fromDir('./', '.test.ts')

const code = await Bun.build({
  entrypoints: files,
  external: [
    "bun:test"
  ]
})

for(const output of code.outputs){
  console.log(await output.text())
}

