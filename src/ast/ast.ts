class BunASTNode {
  position = -1;
}
globalThis.BunASTNode = BunASTNode;
// hint to JS engine to store it as a f64
const NullPtrValue = Number.MAX_SAFE_INTEGER;
const bindings = globalThis.BunASTBindings;

const BunAST = {
  EArray: class EArray extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EUnary: class EUnary extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EBinary: class EBinary extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EClass: class EClass extends BunASTNode {
    #ptr = NullPtrValue;
  },
  ENew: class ENew extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EFunction: class EFunction extends BunASTNode {
    #ptr = NullPtrValue;
  },
  ECall: class ECall extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EDot: class EDot extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EIndex: class EIndex extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EArrow: class EArrow extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EIdentifier: class EIdentifier extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EImportIdentifier: class EImportIdentifier extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EPrivateIdentifier: class EPrivateIdentifier extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EJsxElement: class EJsxElement extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EObject: class EObject extends BunASTNode {
    #ptr = NullPtrValue;
  },
  ESpread: class ESpread extends BunASTNode {
    #ptr = NullPtrValue;
  },
  ETemplatePart: class ETemplatePart extends BunASTNode {
    #ptr = NullPtrValue;
  },
  ETemplate: class ETemplate extends BunASTNode {
    #ptr = NullPtrValue;
  },
  ERegExp: class ERegExp extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EAwait: class EAwait extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EYield: class EYield extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EIf: class EIf extends BunASTNode {
    no = NullPtrValue;
    yes = NullPtrValue;
    test = NullPtrValue;
  },
  ERequire: class ERequire extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EImport: class EImport extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EBoolean: class EBoolean extends BunASTNode {
    val = false;
  },
  ENumber: class ENumber extends BunASTNode {
    val = 0;
  },
  EBigInt: class EBigInt extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EString: class EString extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EMissing: class EMissing extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EThis: class EThis extends BunASTNode {},
  ESuper: class ESuper extends BunASTNode {
    #ptr = NullPtrValue;
  },
  ENull: class ENull extends BunASTNode {},
  EUndefined: class EUndefined extends BunASTNode {},
  ENewTarget: class ENewTarget extends BunASTNode {
    #ptr = NullPtrValue;
  },
  EImportMeta: class EImportMeta extends BunASTNode {},
  SImport: class SImport extends BunASTNode {
    #ptr = NullPtrValue;
  },
};
globalThis.BunAST = BunAST;
const bunTags = [
  BunAST.EArray,
  BunAST.EUnary,
  BunAST.EBinary,
  BunAST.EClass,
  BunAST.ENew,
  BunAST.EFunction,
  BunAST.ECall,
  BunAST.EDot,
  BunAST.EIndex,
  BunAST.EArrow,
  BunAST.EIdentifier,
  BunAST.EImportIdentifier,
  BunAST.EPrivateIdentifier,
  BunAST.EJsxElement,
  BunAST.EObject,
  BunAST.ESpread,
  BunAST.ETemplatePart,
  BunAST.ETemplate,
  BunAST.ERegExp,
  BunAST.EAwait,
  BunAST.EYield,
  BunAST.EIf,
  BunAST.ERequire,
  BunAST.EImport,
  BunAST.EBoolean,
  BunAST.ENumber,
  BunAST.EBigInt,
  BunAST.EString,
  BunAST.EMissing,
  BunAST.EThis,
  BunAST.ESuper,
  BunAST.ENull,
  BunAST.EUndefined,
  BunAST.ENewTarget,
  BunAST.EImportMeta,
  BunAST.SImport,
];
globalThis.bunTags = bunTags;

