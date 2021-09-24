globalThis.BunASTNode ??= class BunASTNode {
  position = -1;
};

if (!globalThis.BunAST) {
  globalThis.BunAST = {
    EArray: class EArray extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EUnary: class EUnary extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EBinary: class EBinary extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EClass: class EClass extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    ENew: class ENew extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EFunction: class EFunction extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    ECall: class ECall extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EDot: class EDot extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EIndex: class EIndex extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EArrow: class EArrow extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EIdentifier: class EIdentifier extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EImportIdentifier: class EImportIdentifier extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EPrivateIdentifier: class EPrivateIdentifier extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EJsxElement: class EJsxElement extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EObject: class EObject extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    ESpread: class ESpread extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    ETemplatePart: class ETemplatePart extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    ETemplate: class ETemplate extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    ERegExp: class ERegExp extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EAwait: class EAwait extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EYield: class EYield extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EIf: class EIf extends BunASTNode {
      no = Number.MAX_SAFE_INTEGER;
      yes = Number.MAX_SAFE_INTEGER;
    },
    ERequire: class ERequire extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EImport: class EImport extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EBoolean: class EBoolean extends BunASTNode {
      val = false;
    },
    ENumber: class ENumber extends BunASTNode {
      val = 0;
    },
    EBigInt: class EBigInt extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EString: class EString extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EMissing: class EMissing extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EThis: class EThis extends BunASTNode {},
    ESuper: class ESuper extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    ENull: class ENull extends BunASTNode {},
    EUndefined: class EUndefined extends BunASTNode {},
    ENewTarget: class ENewTarget extends BunASTNode {
      #ptr = Number.MAX_SAFE_INTEGER;
    },
    EImportMeta: class EImportMeta extends BunASTNode {},
  };
}
