import KingWorld from 'kingworld'

new KingWorld()
    .get("/", () => "Hello KingWorld")
    .listen(3000)

console.log('🦊 KINGWORLD is running at :3000')
