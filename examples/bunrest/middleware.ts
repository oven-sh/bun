
export const defaultMiddleware = (req, res, next) => {
    console.log('You are in the middleware');
    next()
}

export const testMiddleware = (req, res, next) => {
    res.status(200).send('You are in test middleware');
}