import { jest, mock, test, vi } from 'bun:test'
test('it', async () => {
    const said = []
    said.push(require('./g.cjs').word)
    const early = await import('./g.cjs')
    vi.doMock('./g.cjs', () => ({ word: 'own' }))
    vi.doUnmock('./g.cjs')
    const whole = await import('./g.cjs')
    said.push('early is whole ' + (early === whole))
    mock.module('./g.cjs', () => ({ word: 'patch' }))
    said.push(early.word, whole.word)
    vi.doUnmock('./g.cjs')
    const again = await import('./g.cjs')
    said.push(early.word, whole.word, again.word, 'again is whole ' + (again === whole), 'again is early ' + (again === early))
    console.log('SAID', said.join(' | '), globalThis.runs ?? 0)
})
