import Server from 'bunrest';

const app = Server();
const router = app.router();

router.get('/', (req, res) => {
    res.status(200).send('You are in router');
})

export default router;