import { jest, mock, test, vi } from 'bun:test'
test('it', async () => {
    const said = []
    said.push(require('./g.cjs').word)
    vi.doMock('./g.cjs', () => ({ word: 'own' }))
    vi.doUnmock('./g.cjs')
    const whole = await import('./g.cjs')
    mock.module('./g.cjs', () => ({ word: 'patch' }))
    vi.doUnmock('./g.cjs')
    said.push(whole.word)
    mock.module('./g.cjs', () => ({ word: 'second' }))
    said.push(whole.word)
    vi.doUnmock('./g.cjs')
    const again = await import('./g.cjs')
    said.push(whole.word, again.word, 'one object ' + (again === whole))
    console.log('SAID', said.join(' | '), globalThis.runs ?? 0)
})
