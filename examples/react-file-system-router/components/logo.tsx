import {logoData} from './logo-data'

export const Logo = ()=><div style={
    {
        display:'inline-block',
        inlineSize:171, 
        blockSize:150, 
        margin:10, 
        backgroundImage: `url(${logoData})`
    }
}></div>
