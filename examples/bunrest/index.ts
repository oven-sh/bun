import Server from "bunrest";
import testRouter from './router';
import { defaultMiddleware, testMiddleware } from "./middleware";

const app = Server();

app.use(defaultMiddleware)

app.get('/', (req, res) => {
    res.status(200).send('Hello world !');
});

app.put('/', (req, res) => {
    res.status(200).json({ message: 'PUT jobs' });
})

app.post('/', (req, res) => {
    res.status(500).send('Denied');
})

app.use('/route', testRouter);

app.get('/test', testMiddleware, (req, res) => {})

app.listen(3000, () => {
    console.log('App is listening to port 3000')
})