// The two callbacks of one .then() each make a literal; the promises go through Promise.all; the elements are stored into a loop variable whose type is the union of the two records.
import { stat } from 'node:fs/promises'

async function existing(candidates: string[]): Promise<string[]> {
  const probes = await Promise.all(
    candidates.map(dir =>
      stat(dir).then(
        () => ({ dir, exists: true as const }),
        (error: unknown) => ({ dir, exists: false as const, error }),
      ),
    ),
  )
  const dirs: string[] = []
  for (const probe of probes) {
    const { dir } = probe
    if (probe.exists) {
      dirs.push(dir)
      continue
    }
    const e = probe.error
    dirs.push('no ' + dir + ' ' + (e instanceof Error))
  }
  return dirs
}

console.log((await existing(['/', '/no-such-folder-here', '/tmp'])).join(' | '))
