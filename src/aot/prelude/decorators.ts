// Same behavior as __legacyDecorateClassTS, __legacyDecorateParamTS and __legacyMetadataTS in src/runtime.js ("bun:wrap").

export function decorateClass(decorators: any[], target: any): any {
    let result = target;
    if (typeof Reflect === "object" && typeof (Reflect as any).decorate === "function") {
        return (Reflect as any).decorate(decorators, target, undefined, undefined);
    }
    for (let i = decorators.length - 1; i >= 0; i--) {
        const decorator = decorators[i];
        if (decorator) result = decorator(result) || result;
    }
    return result;
}

export function decorateMember(decorators: any[], target: any, key: any, descriptor: any): any {
    if (descriptor === null) descriptor = Object.getOwnPropertyDescriptor(target, key);
    let result = descriptor;
    if (typeof Reflect === "object" && typeof (Reflect as any).decorate === "function") {
        result = (Reflect as any).decorate(decorators, target, key, descriptor);
    } else {
        for (let i = decorators.length - 1; i >= 0; i--) {
            const decorator = decorators[i];
            if (decorator) result = decorator(target, key, result) || result;
        }
    }
    if (result) Object.defineProperty(target, key, result);
    return result;
}

export function decorateParameter(index: number, decorator: any): any {
    return (target: any, key: any) => decorator(target, key, index);
}

export function decoratorMetadata(key: any, value: any): any {
    if (typeof Reflect === "object" && typeof (Reflect as any).metadata === "function") return (Reflect as any).metadata(key, value);
}
